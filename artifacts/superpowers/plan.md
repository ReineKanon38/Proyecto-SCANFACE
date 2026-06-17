## Goal
Optimizar y robustecer el sistema ScanFace a nivel local como prioridad absoluta para entregar un MVP funcional y de alta calidad antes del 17/06/2026. Las mejoras locales incluyen:
1. **Filtro de Calidad y Borrosidad (Anti-Blur)**: Utilizar la varianza del Laplaciano en OpenCV para descartar caras difuminadas en tiempo real y en la carga de fotos, solicitando al alumno quedarse quieto para asegurar coincidencia biométrica fiable.
2. **Robustez ante Escala e Iluminación (Zoom/Crecimiento)**: Documentar y verificar el uso de `alignCrop` de OpenCV para normalizar el tamaño y la rotación del rostro detectado (haciendo que el reconocimiento sea independiente del tamaño o distancia de la cara a la cámara).
3. **Configuración de Cámara Flex**: Configurar fuentes de cámara local, por USB (celular virtual DroidCam) o de red mediante el archivo `.env`.
4. **Apagado Inteligente en Admin**: Desactivar físicamente la webcam al entrar a la sección de administración para evitar molestias de LED encendido.
5. **Detección de Lentes (Eyeglasses)**: Adaptar el liveness para parpadeo detrás de lentes de graduación y sol usando `haarcascade_eye_tree_eyeglasses.xml`.
6. **Modo Nube (Mejora a Futuro)**: Dejar preparada la infraestructura de WebSockets en el código local para que la transición a producción en la nube (Vercel/Render) sea directa como una mejora futura.

## Assumptions
- La estabilidad y fiabilidad local es la meta principal del MVP. El despliegue en la nube se deja como extensión documentada pero ya soportada en el código.
- Para usar la cámara del celular conectada por USB se requiere un software virtual (ej. DroidCam) que Windows reconozca como un dispositivo de captura de video (Cámara index `0` o `1` en `.env`).
- Las caras que estén muy borrosas o en movimiento rápido se filtrarán localmente calculando la varianza del Laplaciano (si es menor a un umbral como 100.0, se ignora el frame y se pide re-enfocar).

## Plan
### Step 1: Configurar Variables de Entorno y Soporte de Cámara USB/Celular
- **Files**:
  - [.env](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/.env) [MODIFY]
  - [src/main.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/main.py) [MODIFY]
- **Change**: 
  - Añadir la variable de entorno `CAMERA_SOURCE` en `.env` (entero o string de red).
  - Ajustar `src/main.py` para levantar la cámara según la configuración de `CAMERA_SOURCE`.
- **Verify**: Cambiar `CAMERA_SOURCE` en `.env` a una cámara inactiva y verificar que el sistema muestre la pantalla de error correspondiente.

### Step 2: Implementar Filtro de Nitidez (Anti-Blur) y Robustez de Escala
- **Files**:
  - [src/recognizer.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/recognizer.py) [MODIFY]
- **Change**:
  - Crear la función `is_image_blurry(img, threshold=100.0)` usando la varianza del operador Laplaciano (`cv2.Laplacian(gray, cv2.CV_64F).var()`).
  - Aplicar este filtro sobre el ROI de la cara detectada en la transmisión en vivo y en la carga del enrolamiento. Si el rostro está difuminado, el sistema no intentará extraer embeddings y enviará una alerta.
  - Asegurar el alineamiento y escalado automático de caras en la entrada de SFace mediante `alignCrop` para normalizar cambios de zoom o crecimiento.
- **Verify**: Ejecutar `.\.venv\Scripts\python.exe -m src.recognizer` y verificar la correcta inicialización de los clasificadores Haar y filtros.

### Step 3: Implementar Robustez de Parpadeo Detrás de Lentes
- **Files**:
  - [src/recognizer.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/recognizer.py) [MODIFY]
- **Change**:
  - Integrar el clasificador `haarcascade_eye_tree_eyeglasses.xml` de forma prioritaria en `detect_blinking` para capturar el parpadeo de ojos que llevan lentes puestos.
  - Relajar ligeramente los parámetros de búsqueda del clasificador en el ROI de ojos para manejar brillos de cristales.
- **Verify**: Ejecutar pruebas unitarias de importación sin fallos.

### Step 4: Desarrollar la API WebSocket (Preparación para Producción Nube)
- **Files**:
  - [src/main.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/main.py) [MODIFY]
- **Change**:
  - Agregar el endpoint de WebSocket `/api/ws_video_feed` en FastAPI.
  - Este endpoint decodificará imágenes en base64, aplicará el filtro de borrosidad, extraerá embeddings, buscará coincidencias en Supabase y devolverá los metadatos de las cajas de rostros y la asistencia.
- **Verify**: Comprobar sintaxis y levantar el backend local en el puerto 8000.

### Step 5: Actualizar Frontend en React (Doble Modo y Cierre de Cámara)
- **Files**:
  - [frontend/src/App.jsx](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/frontend/src/App.jsx) [MODIFY]
  - [frontend/src/index.css](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/frontend/src/index.css) [MODIFY]
- **Change**:
  - Implementar la opción de visualización para Modo Local (MJPEG) y Modo Nube (Captura de navegador transmitida por WebSocket).
  - Incluir el dibujo de cajas sobre el video utilizando coordenadas JSON devueltas por el WebSocket en Modo Nube.
  - Asegurar la detención completa de cualquier recurso de cámara (MJPEG e hilos de WebSocket) al navegar a la pestaña de administración.
  - Agregar en la UI mensajes dinámicos como "Imagen difuminada, quédese quieto" al fallar el filtro Laplaciano.
- **Verify**: Compilar producción con `npm run build` en el frontend.

### Step 6: Pruebas Locales Finales de Integración
- **Files**: None
- **Change**:
  - Probar el sistema de manera 100% local simulando la asistencia de alumnos con y sin lentes, y usando fotos movidas/difuminadas para validar las advertencias del sistema.
- **Verify**: El sistema debe denegar el acceso ante fotos estáticas (liveness pasivo) y registrar asistencia correcta en Supabase en menos de 1.5s ante rostros reales nítidos.

## Risks & mitigations
- **Risk**: Falsos negativos del detector de parpadeo causados por lentes con marcos gruesos o luces de reflejo directo.
  - *Mitigation*: El sistema informa en pantalla "Ajuste el ángulo si usa lentes" y el backend ejecuta detección complementaria tanto de ojos normales como de lentes en el ROI.
- **Risk**: El procesamiento de la varianza del Laplaciano en computadoras de bajo rendimiento reduce los FPS del video.
  - *Mitigation*: El cálculo se realiza únicamente sobre el recorte (ROI) del rostro detectado por YuNet (que mide apenas unos píxeles) y no sobre el frame completo de 640x480, lo que reduce la carga computacional en un 90%.

## Rollback plan
- Volver a la versión previa estable del código en caso de bloqueos irreparables usando `git checkout src/main.py src/recognizer.py frontend/src/App.jsx`.
