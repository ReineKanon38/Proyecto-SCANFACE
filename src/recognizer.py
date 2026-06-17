import os
import urllib.request
import cv2
import numpy as np
from src.db import update_frontal_embedding

MODELS_DIR = "models"
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

YUNET_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

def download_models():
    """Downloads YuNet and SFace models if they are missing."""
    if not os.path.exists(MODELS_DIR):
        os.makedirs(MODELS_DIR)
        
    for url, path in [(YUNET_URL, YUNET_PATH), (SFACE_URL, SFACE_PATH)]:
        if not os.path.exists(path):
            print(f"Downloading model from {url} to {path}...")
            try:
                urllib.request.urlretrieve(url, path)
                print(f"Downloaded {os.path.basename(path)} successfully.")
            except Exception as e:
                print(f"Error downloading {url}: {e}")
                raise e

class FaceEngine:
    def __init__(self):
        download_models()
        
        # Load YuNet detector (initial size 320x320, updated dynamically)
        self.detector = cv2.FaceDetectorYN.create(
            model=YUNET_PATH,
            config="",
            input_size=(320, 320),
            score_threshold=0.8,
            nms_threshold=0.3,
            top_k=5000
        )
        
        # Load SFace recognizer
        self.recognizer = cv2.FaceRecognizerSF.create(
            model=SFACE_PATH,
            config=""
        )
        
        # Load eye Haar Cascades for blink detection
        self.eye_cascade_glasses = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye_tree_eyeglasses.xml')
        self.eye_cascade_normal = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
            
        # Keep track of blink history for liveness
        # Map: student_id or "session_face" -> {"blink_count": int, "eyes_closed": bool, "closed_frames": int}
        self.liveness_history = {}

    def is_image_blurry(self, img, threshold=80.0):
        """
        Calculates the Laplacian variance to check if the image is blurry.
        Returns (is_blurry, variance_value).
        """
        if img is None or img.size == 0:
            return True, 0.0
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        val = cv2.Laplacian(gray, cv2.CV_64F).var()
        return val < threshold, val

    def detect_faces(self, frame):
        """Detects faces in the frame. Updates input_size dynamically."""
        h, w = frame.shape[:2]
        self.detector.setInputSize((w, h))
        retval, faces = self.detector.detect(frame)
        if retval and faces is not None:
            return faces
        return []

    def get_eye_regions(self, frame, landmarks, box):
        """Extracts regions around the eyes for Haar Cascade check."""
        h, w = frame.shape[:2]
        face_x, face_y, face_w, face_h = map(int, box[0:4])
        
        # Eye landmarks: left eye (x, y) = landmarks[0], landmarks[1]
        # right eye (x, y) = landmarks[2], landmarks[3]
        lex, ley = int(landmarks[0]), int(landmarks[1])
        rex, rey = int(landmarks[2]), int(landmarks[3])
        
        # Define a small ROI around each eye center
        roi_w = int(face_w * 0.22)
        roi_h = int(face_h * 0.18)
        
        # Guard limits
        lx1, ly1 = max(0, lex - roi_w // 2), max(0, ley - roi_h // 2)
        lx2, ly2 = min(w, lex + roi_w // 2), min(h, ley + roi_h // 2)
        
        rx1, ry1 = max(0, rex - roi_w // 2), max(0, rey - roi_h // 2)
        rx2, ry2 = min(w, rex + roi_w // 2), min(h, rey + roi_h // 2)
        
        left_eye_roi = frame[ly1:ly2, lx1:lx2]
        right_eye_roi = frame[ry1:ry2, rx1:rx2]
        
        return left_eye_roi, right_eye_roi

    def detect_eyes_in_roi(self, gray_roi):
        """Helper to detect eyes using both glasses and normal cascades."""
        if gray_roi is None or gray_roi.size == 0:
            return False
        # Try glasses cascade first (more permissive to reflections)
        eyes_glasses = self.eye_cascade_glasses.detectMultiScale(gray_roi, scaleFactor=1.05, minNeighbors=3, minSize=(10, 10))
        if len(eyes_glasses) > 0:
            return True
        # Try normal cascade next
        eyes_normal = self.eye_cascade_normal.detectMultiScale(gray_roi, scaleFactor=1.08, minNeighbors=2, minSize=(10, 10))
        if len(eyes_normal) > 0:
            return True
        return False

    def detect_blinking(self, frame, face_id, landmarks, box):
        """
        Detección de parpadeo (liveness).
        Retorna (blink_count, is_currently_closed).
        """
        left_roi, right_roi = self.get_eye_regions(frame, landmarks, box)
        
        # Convert to grayscale for Haar Cascade
        gray_l = cv2.cvtColor(left_roi, cv2.COLOR_BGR2GRAY) if left_roi.size > 0 else None
        gray_r = cv2.cvtColor(right_roi, cv2.COLOR_BGR2GRAY) if right_roi.size > 0 else None
        
        # Check both eyes
        eyes_detected = self.detect_eyes_in_roi(gray_l) or self.detect_eyes_in_roi(gray_r)
                
        # Update blink status in session history
        if face_id not in self.liveness_history:
            self.liveness_history[face_id] = {"blink_count": 0, "eyes_closed": False, "closed_frames": 0}
            
        hist = self.liveness_history[face_id]
        
        is_closed = not eyes_detected
        
        if is_closed:
            hist["closed_frames"] += 1
            if hist["closed_frames"] >= 1: # Closed for at least 1 frame
                hist["eyes_closed"] = True
        else:
            # Transition: was closed, now open -> registered blink!
            if hist["eyes_closed"] and hist["closed_frames"] <= 8: # Avoid registering blink if eyes were closed too long (e.g. absent)
                hist["blink_count"] += 1
                print(f"[LIVENESS] Blink detected for {face_id}. Count: {hist['blink_count']}")
            hist["eyes_closed"] = False
            hist["closed_frames"] = 0
            
        return hist["blink_count"], is_closed

    def extract_embedding(self, frame, face_info):
        """Aligns the face and extracts the 128D embedding."""
        aligned_face = self.recognizer.alignCrop(frame, face_info)
        embedding = self.recognizer.feature(aligned_face)
        return embedding[0] # Return 1D array of 128 floats

    def compare_embeddings(self, e1, e2):
        """Calculates cosine similarity between two embeddings."""
        # e1 and e2 are 128D numpy arrays
        # Cosine match score returned by OpenCV is typically [-1, 1]
        # SFace match uses:
        # score = self.recognizer.match(e1.reshape(1, -1), e2.reshape(1, -1), cv2.FaceRecognizerSF_FR_COSINE)
        dot_product = np.dot(e1, e2)
        norm_e1 = np.linalg.norm(e1)
        norm_e2 = np.linalg.norm(e2)
        if norm_e1 == 0 or norm_e2 == 0:
            return 0.0
        similarity = dot_product / (norm_e1 * norm_e2)
        return float(similarity)

    def match_face(self, query_embedding, cached_students, threshold=0.363):
        """
        Compares query embedding with cached students.
        Returns (student_id, best_score).
        """
        best_student_id = None
        best_score = -1.0
        
        for student in cached_students:
            student_id = student["id"]
            
            # Embeddings are stored in Supabase as JSON arrays of 128 floats
            # We parse them
            for col in ["embedding_frontal", "embedding_accessories"]:
                if student.get(col):
                    saved_emb = np.array(student[col], dtype=np.float32)
                    score = self.compare_embeddings(query_embedding, saved_emb)
                    if score > best_score:
                        best_score = score
                        best_student_id = student_id
                        
        if best_score >= threshold:
            return best_student_id, best_score
        return None, best_score

    def update_adaptive_embedding(self, student_id, cached_students, current_embedding, match_score, high_confidence_threshold=0.60):
        """
        Updates the frontal embedding adaptively in Supabase and memory
        to learn from daily physical changes (e.g. hair growth, haircuts).
        """
        if match_score < high_confidence_threshold:
            return
            
        # Find student in cache
        student = next((s for s in cached_students if s["id"] == student_id), None)
        if not student or not student.get("embedding_frontal"):
            return
            
        old_frontal = np.array(student["embedding_frontal"], dtype=np.float32)
        
        # Adaptive formula: 90% old, 10% new
        updated_raw = (old_frontal * 0.9) + (current_embedding * 0.1)
        # Normalize to unit vector
        norm = np.linalg.norm(updated_raw)
        if norm > 0:
            updated_frontal = (updated_raw / norm).tolist()
            # Update cache
            student["embedding_frontal"] = updated_frontal
            # Update Supabase in the background
            update_frontal_embedding(student_id, updated_frontal)
            print(f"[ADAPTIVE] Updated embedding for student {student_id} (confidence: {match_score:.3f})")

if __name__ == "__main__":
    print("Testing FaceEngine initialization and download...")
    engine = FaceEngine()
    print("FaceEngine loaded successfully!")
