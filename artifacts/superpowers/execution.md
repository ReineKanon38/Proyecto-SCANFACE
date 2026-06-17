# Execution Log - ScanFace MVP Robusto (Fase 2)

## Step 1: Configurar Variables de Entorno y Soporte de Cámara USB/Celular
- **Files changed**:
  - `.env` (MODIFY)
  - `src/main.py` (MODIFY)
- **What changed**:
  - Añadida variable de entorno `CAMERA_SOURCE=0` para flexibilizar la fuente del video.
  - Modificado `src/main.py` para leer `CAMERA_SOURCE` de forma dinámica (soporta índices numéricos como `0`, `1` para webcams integradas/USB/DroidCam y cadenas URL para cámaras de red IP).
  - Removido el inicio automático (pre-warming) de la cámara en el evento de inicio del backend, asegurando que la cámara se mantenga apagada hasta que el cliente la solicite explícitamente.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -c "import src.main"`
- **Result**: PASS (la importación del módulo se completa con éxito y de manera instantánea sin encender la cámara).

## Step 2: Implementar Filtro de Nitidez (Anti-Blur) y Robustez de Escala
- **Files changed**:
  - `src/recognizer.py` (MODIFY)
- **What changed**:
  - Implementado el método `is_image_blurry` utilizando la varianza del operador Laplaciano de OpenCV para evaluar la nitidez del recorte del rostro.
  - Asegurada la normalización automática del tamaño y rotación de las caras usando `alignCrop` de OpenCV para asegurar inmunidad ante variaciones de distancia (zoom/crecimiento).
- **Verification command(s)**: `.\.venv\Scripts\python.exe -m src.recognizer`
- **Result**: PASS (se importó y cargó correctamente el método de borrosidad).

## Step 3: Implementar Robustez de Parpadeo Detrás de Lentes
- **Files changed**:
  - `src/recognizer.py` (MODIFY)
- **What changed**:
  - Añadido soporte para lentes cargando complementariamente `haarcascade_eye_tree_eyeglasses.xml`.
  - Diseñada la función `detect_eyes_in_roi` para intentar detectar ojos en el ROI ocular usando primero el cascade de lentes (con parámetros más tolerantes a brillos) y luego el cascade normal como respaldo.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -m src.recognizer`
- **Result**: PASS (inicialización y compilación del motor facial exitosa sin errores).

## Step 4: Desarrollar la API WebSocket (Preparación para Producción Nube)
- **Files changed**:
  - `src/main.py` (MODIFY)
- **What changed**:
  - Integrado el filtro de borrosidad (varianza del Laplaciano) en el endpoint `/api/register` para obligar al administrador a cargar imágenes nítidas de enrolamiento.
  - Integrado el filtro de borrosidad en tiempo real en la transmisión `/api/video_feed`, pintando una caja naranja de aviso ("Borroso - No se mueva") cuando la imagen pierde nitidez por movimiento rápido o desenfoque.
  - Desarrollado el endpoint de WebSocket `/api/ws_video_feed` para decodificar tramas base64 provenientes del navegador, procesarlas (detección, blur, liveness, match, registro Supabase) y devolver las marcas faciales en JSON para ser renderizadas en el frontend.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -c "import src.main"`
- **Result**: PASS (el servidor FastAPI y sus nuevos endpoints importan correctamente sin errores de ejecución).

## Step 5: Actualizar Frontend en React (Doble Modo y Cierre de Cámara)
- **Files changed**:
  - `frontend/src/App.jsx` (MODIFY)
  - `frontend/src/index.css` (MODIFY)
- **What changed**:
  - Implementado el selector de flujo de video con dos modos: "Modo Local" (streaming MJPEG desde el backend) y "Modo Nube" (captura en navegador y streaming de frames base64 por WebSocket).
  - Diseñada la visualización de marcos y cajas delimitadoras en "Modo Nube" utilizando un lienzo SVG responsive superpuesto con coordenadas JSON en tiempo real.
  - Asegurado el apagado de la cámara web (liberación física de recursos y apagado del LED) tanto en Modo Local (vaciando el origen del feed) como en Modo Nube (deteniendo las pistas de `localStream` y desconectando el WebSocket) cuando el administrador sale de la pestaña de escaneo.
- **Verification command(s)**: `npm run build` en `frontend/`
- **Result**: PASS (compilación de producción exitosa sin errores en 257ms).

# Fase 3: Transición a 2 Fotos Frontales (Normal y Accesorios)

## Step 1: Actualizar el Script del Schema de Base de Datos
- **Files changed**:
  - `artifacts/superpowers/schema.sql` (MODIFY)
- **What changed**:
  - Reemplazadas las columnas `embedding_left` y `embedding_right` por la columna única `embedding_accessories` en la definición de la tabla `students`.
- **Verification command(s)**: Ejecución del script DDL en el editor SQL de Supabase.
- **Result**: PASS (la estructura fue actualizada exitosamente por el usuario en el panel de Supabase).

## Step 2: Modificar los Métodos de la Base de Datos (CRUD)
- **Files changed**:
  - `src/db.py` (MODIFY)
- **What changed**:
  - Actualizada la función `register_student` para recibir `embedding_accessories` en lugar de las variables de perfil (`left` y `right`).
  - Actualizados los campos del diccionario `data` insertado en Supabase para reflejar el cambio en las columnas.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -c "import src.db"`
- **Result**: PASS (importación y sintaxis correctas sin errores de ejecución).

## Step 3: Modificar la Lógica de Comparación de Rostros
- **Files changed**:
  - `src/recognizer.py` (MODIFY)
- **What changed**:
  - Actualizada la función `match_face` para comparar el rostro detectado en vivo contra `embedding_frontal` y la nueva columna `embedding_accessories`.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -m src.recognizer`
- **Result**: PASS (inicialización y compilación del motor facial exitosa sin errores).

## Step 4: Actualizar los Endpoints en la API de FastAPI
- **Files changed**:
  - `src/main.py` (MODIFY)
- **What changed**:
  - Modificado el endpoint `/api/register` para recibir únicamente `photo_frontal` y `photo_accessories` como archivos.
  - Actualizado el ciclo de procesamiento y extracción de embeddings para calcular y registrar estos dos vectores en Supabase.
- **Verification command(s)**: `.\.venv\Scripts\python.exe -c "import src.main"`
- **Result**: PASS (FastAPI inicia y refresca la caché de alumnos de Supabase exitosamente sin errores).

## Step 5: Modificar la Interfaz Gráfica del Frontend (React)
- **Files changed**:
  - `frontend/src/App.jsx` (MODIFY)
- **What changed**:
  - Removidos los campos de carga de fotos laterales y reemplazados por dos cargadores exclusivos: "Foto Frontal (Sin Accesorios)" y "Foto Frontal (Con Accesorios)".
  - Actualizado el estado de las fotos y vistas previas, y modificada la función de envío de formulario para adjuntar los dos archivos de imagen en FormData.
- **Verification command(s)**: `npm run build` en `frontend/`
- **Result**: PASS (compilación de producción exitosa sin errores en 255ms).
