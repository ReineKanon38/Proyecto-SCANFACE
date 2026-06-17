import os
import sys
import base64

# Add project root directory to sys.path to resolve imports when executed directly
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.append(project_root)

import threading
import time
from datetime import datetime
from io import BytesIO
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import cv2
import numpy as np
import pandas as pd

from src.db import (
    get_all_students,
    register_student,
    log_attendance,
    get_attendance_report
)
from src.crypto_utils import encrypt_data, decrypt_data
from src.recognizer import FaceEngine

# Initialize FastAPI app
app = FastAPI(title="ScanFace API", description="Backend para el Sistema de Asistencia ScanFace")

# Add CORS Middleware to support React development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Face Engine
engine = FaceEngine()

# Global cache for students in memory to maximize speed and bypass db requests on frame loop
students_cache = []

def refresh_students_cache():
    global students_cache
    print("[CACHE] Refreshing students cache from Supabase...")
    students_cache = get_all_students()
    print(f"[CACHE] Cached {len(students_cache)} students.")

# Populate cache on startup
refresh_students_cache()

# Thread-safe Camera Stream class
class CameraStream:
    def __init__(self, src=0):
        # On Windows, using DirectShow (cv2.CAP_DSHOW) dramatically reduces camera initialization delay
        if os.name == 'nt' and isinstance(src, int):
            self.stream = cv2.VideoCapture(src, cv2.CAP_DSHOW)
            if not self.stream.isOpened():
                self.stream = cv2.VideoCapture(src)
        else:
            self.stream = cv2.VideoCapture(src)
            
        self.stream.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.stream.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.grabbed, self.frame = self.stream.read()
        self.read_lock = threading.Lock()
        self.running = True
        self.thread = threading.Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()

    def update(self):
        while self.running:
            grabbed, frame = self.stream.read()
            if grabbed:
                with self.read_lock:
                    self.grabbed = grabbed
                    self.frame = frame
            time.sleep(0.01)

    def read(self):
        with self.read_lock:
            if not self.grabbed or self.frame is None:
                return False, None
            return True, self.frame.copy()

    def stop(self):
        self.running = False
        if self.thread.is_alive():
            self.thread.join()
        self.stream.release()

camera = None
active_connections = 0
camera_lock = threading.Lock()

def get_camera():
    global camera
    if camera is None or not camera.running:
        source_str = os.environ.get("CAMERA_SOURCE", "0")
        try:
            source = int(source_str)
        except ValueError:
            source = source_str
        camera = CameraStream(source)
        print(f"[CAMERA] Camera stream initialized with source: {source}")
    return camera

def release_camera():
    global camera
    if camera is not None:
        camera.stop()
        camera = None
        print("[CAMERA] Camera stream released.")

@app.on_event("startup")
def startup_event():
    # Do NOT pre-warm camera on startup to keep it off until requested by frontend
    print("[SERVER] Backend started. Camera is offline.")

@app.on_event("shutdown")
def shutdown_event():
    release_camera()

@app.post("/api/login")
def login(password: str = Form(...)):
    """Simple password-based login for admin panel."""
    # A simple static password
    if password == "admin123":
        return {"success": True, "token": "admin-session-token"}
    raise HTTPException(status_code=401, detail="Contraseña incorrecta")

@app.post("/api/register")
async def register(
    student_id: str = Form(...),
    name: str = Form(...),
    photo_frontal: UploadFile = File(...),
    photo_accessories: UploadFile = File(...)
):
    """
    Registers a new student by processing two frontal photos.
    Extracts embeddings for each and saves to Supabase.
    """
    embeddings = {}
    
    # Process the two images
    photos = {
        "embedding_frontal": photo_frontal,
        "embedding_accessories": photo_accessories
    }
    
    for key, file in photos.items():
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail=f"No se pudo decodificar la imagen: {file.filename}")
            
        faces = engine.detect_faces(img)
        if len(faces) == 0:
            raise HTTPException(status_code=400, detail=f"No se detectó ningún rostro en la foto {file.filename}")
            
        # Get the largest face in the photo
        face_info = faces[0]
        
        # Align face and check blurriness on the aligned face ROI
        aligned_face = engine.recognizer.alignCrop(img, face_info)
        is_blurry, blur_val = engine.is_image_blurry(aligned_face)
        if is_blurry:
            raise HTTPException(
                status_code=400,
                detail=f"La foto {file.filename} está difuminada o movida (Varianza: {blur_val:.1f} < 80.0). Por favor, suba una foto más nítida."
            )
            
        emb = engine.extract_embedding(img, face_info)
        embeddings[key] = emb.tolist()
        
    # Encrypt student name for Privacy by Design
    encrypted_name = encrypt_data(name)
    
    try:
        register_student(
            student_id=student_id,
            encrypted_name=encrypted_name,
            embedding_frontal=embeddings["embedding_frontal"],
            embedding_accessories=embeddings["embedding_accessories"]
        )
        # Refresh local cache
        refresh_students_cache()
        return {"success": True, "message": f"Estudiante {name} registrado con éxito."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en base de datos: {e}")

@app.post("/api/refresh_cache")
def refresh_cache():
    """Manually refresh the student list cache."""
    refresh_students_cache()
    return {"success": True, "count": len(students_cache)}

def generate_video_stream():
    """Generates the MJPEG stream with real-time face detection, liveness, and matching."""
    global active_connections
    with camera_lock:
        active_connections += 1
        cam = get_camera()
        
    try:
        while True:
            success, frame = cam.read()
            if not success:
                # Send black placeholder frame if camera fails
                black_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(black_frame, "Camara no disponible", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                ret, encoded = cv2.imencode('.jpg', black_frame)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + bytearray(encoded) + b'\r\n')
                time.sleep(0.1)
                continue
                
            faces = engine.detect_faces(frame)
            
            for face in faces:
                box = face[0:4]
                landmarks = face[4:14]
                x, y, w, h = map(int, box)
                
                # Align face crop first to standardise size and check blurriness
                aligned_face = engine.recognizer.alignCrop(frame, face)
                is_blurry, blur_val = engine.is_image_blurry(aligned_face)
                if is_blurry:
                    # Draw warning box (Orange) and skip recognition
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 165, 255), 2)
                    cv2.rectangle(frame, (x, y - 25), (x + w, y), (0, 165, 255), -1)
                    cv2.putText(frame, "No se mueva - Borroso", (x + 5, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
                    continue

                # Extract embedding for matching
                emb = engine.extract_embedding(frame, face)
                
                # Compare face embedding against cached students
                student_id, score = engine.match_face(emb, students_cache)
                
                # Run liveness detection using blink tracking
                # Use student_id (or generic face if not registered) to persist tracking state
                tracking_id = student_id if student_id else "unknown_face"
                blink_count, is_closed = engine.detect_blinking(frame, tracking_id, landmarks, box)
                
                # Check liveness status
                liveness_verified = blink_count > 0
                
                if student_id:
                    # Retrieve and decrypt student details from cache
                    student = next(s for s in students_cache if s["id"] == student_id)
                    decrypted_name = decrypt_data(student["name"])
                    
                    if liveness_verified:
                        # Log attendance in Supabase (logs handle debounce internally)
                        log_attendance(student_id)
                        # Adaptive update of student embedding
                        engine.update_adaptive_embedding(student_id, students_cache, emb, score)
                        
                        color = (0, 255, 0) # Green for match + alive
                        label = f"{decrypted_name} (Verificado)"
                        status_text = f"Asistencia OK (Score: {score:.2f})"
                    else:
                        color = (0, 255, 255) # Yellow for match but waiting for blink
                        label = f"{decrypted_name}"
                        status_text = "Parpadee para confirmar"
                else:
                    color = (0, 0, 255) # Red for unregistered face
                    label = "No Registrado"
                    status_text = "Acceso denegado"
                    
                # Draw bounding box and overlays
                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
                
                # Header label
                cv2.rectangle(frame, (x, y - 25), (x + w, y), color, -1)
                cv2.putText(frame, label, (x + 5, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0) if color != (0,0,255) else (255,255,255), 1, cv2.LINE_AA)
                
                # Status sublabel under bounding box
                cv2.putText(frame, status_text, (x, y + h + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
                # Display blink count
                cv2.putText(frame, f"Parpadeos: {blink_count}", (x, y + h + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

            # Encode frame as JPEG
            ret, encoded_image = cv2.imencode('.jpg', frame)
            if ret:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + bytearray(encoded_image) + b'\r\n')
                
            time.sleep(0.03) # Cap stream at ~30 FPS
    except Exception as e:
        print(f"[STREAM] Connection closed or error: {e}")
    finally:
        with camera_lock:
            active_connections -= 1
            if active_connections <= 0:
                print("[CAMERA] No active stream connections. Releasing camera.")
                release_camera()

@app.post("/api/camera/off")
def camera_off():
    """Forced camera shutdown from frontend controls."""
    global active_connections
    with camera_lock:
        active_connections = 0
        release_camera()
    return {"success": True, "message": "Camera turned off"}

@app.get("/api/video_feed")
def video_feed():
    """Endpoint that returns the processed live webcam video stream."""
    return StreamingResponse(
        generate_video_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.websocket("/api/ws_video_feed")
async def websocket_video_feed(websocket: WebSocket):
    await websocket.accept()
    print("[WEBSOCKET] Client connected.")
    try:
        while True:
            data = await websocket.receive_json()
            if "image" not in data:
                continue
                
            image_data = data["image"]
            if "," in image_data:
                header, encoded = image_data.split(",", 1)
            else:
                encoded = image_data
                
            try:
                img_bytes = base64.b64decode(encoded)
                nparr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            except Exception as e:
                print(f"[WEBSOCKET] Error decoding base64: {e}")
                await websocket.send_json({"error": "Failed to decode image"})
                continue
                
            if frame is None or frame.size == 0:
                await websocket.send_json({"faces": []})
                continue
                
            faces = engine.detect_faces(frame)
            results = []
            
            for face in faces:
                box = face[0:4]
                landmarks = face[4:14]
                x, y, w, h = map(int, box)
                
                # Check blurriness on aligned crop
                aligned_face = engine.recognizer.alignCrop(frame, face)
                is_blurry, blur_val = engine.is_image_blurry(aligned_face)
                
                if is_blurry:
                    results.append({
                        "box": [x, y, w, h],
                        "label": "No se mueva - Borroso",
                        "status_text": f"Nitidez: {blur_val:.1f} < 80",
                        "blink_count": 0,
                        "is_blurry": True,
                        "color": "orange"
                    })
                    continue
                    
                emb = engine.extract_embedding(frame, face)
                student_id, score = engine.match_face(emb, students_cache)
                
                tracking_id = student_id if student_id else "unknown_face"
                blink_count, is_closed = engine.detect_blinking(frame, tracking_id, landmarks, box)
                
                liveness_verified = blink_count > 0
                
                if student_id:
                    student = next(s for s in students_cache if s["id"] == student_id)
                    decrypted_name = decrypt_data(student["name"])
                    
                    if liveness_verified:
                        log_attendance(student_id)
                        engine.update_adaptive_embedding(student_id, students_cache, emb, score)
                        color = "green"
                        label = f"{decrypted_name} (Verificado)"
                        status_text = f"Asistencia OK (Score: {score:.2f})"
                    else:
                        color = "yellow"
                        label = decrypted_name
                        status_text = "Parpadee para confirmar"
                else:
                    color = "red"
                    label = "No Registrado"
                    status_text = "Acceso denegado"
                    
                results.append({
                    "box": [x, y, w, h],
                    "label": label,
                    "status_text": status_text,
                    "blink_count": blink_count,
                    "is_blurry": False,
                    "color": color
                })
                
            await websocket.send_json({"faces": results})
            
    except WebSocketDisconnect:
        print("[WEBSOCKET] Client disconnected.")
    except Exception as e:
        print(f"[WEBSOCKET] Error: {e}")

@app.get("/api/logs")
def get_logs():
    """Gets recent attendance logs with decrypted student names."""
    logs = get_attendance_report()
    processed_logs = []
    
    for log in logs:
        # Decrypt student name
        student_data = log.get("students")
        student_name = "[Estudiante Eliminado]"
        if student_data and "name" in student_data:
            student_name = decrypt_data(student_data["name"])
            
        processed_logs.append({
            "id": log["id"],
            "timestamp": log["timestamp"],
            "student_id": log["student_id"],
            "student_name": student_name
        })
    return processed_logs

@app.get("/api/students")
def get_students_list():
    """Gets list of all students with decrypted names."""
    processed = []
    for student in students_cache:
        processed.append({
            "id": student["id"],
            "name": decrypt_data(student["name"]),
            "created_at": student["created_at"]
        })
    return processed

@app.get("/api/export")
def export_logs():
    """Exports attendance logs as an Excel spreadsheet."""
    logs = get_attendance_report()
    data = []
    
    for log in logs:
        student_data = log.get("students")
        student_name = "[Estudiante Eliminado]"
        if student_data and "name" in student_data:
            student_name = decrypt_data(student_data["name"])
            
        # Parse timestamp to human readable format
        ts_str = log["timestamp"]
        try:
            if ts_str.endswith("Z"):
                ts_str = ts_str[:-1] + "+00:00"
            ts = datetime.fromisoformat(ts_str)
            # Format to YYYY-MM-DD HH:MM:SS
            formatted_time = ts.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            formatted_time = ts_str
            
        data.append({
            "ID Registro": log["id"],
            "ID Alumno": log["student_id"],
            "Nombre": student_name,
            "Fecha y Hora": formatted_time
        })
        
    df = pd.DataFrame(data)
    
    # Save dataframe to an Excel file in memory
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Asistencias')
    output.seek(0)
    
    filename = f"reporte_asistencia_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    
    return StreamingResponse(
        output,
        headers=headers,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

if __name__ == "__main__":
    import uvicorn
    print("Starting ScanFace FastAPI server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
