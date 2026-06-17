## Goal
Modificar el sistema de enrolamiento de alumnos para utilizar 2 fotografías frontales (normal y con accesorios) en lugar de las 3 fotografías (frontal, izquierda, derecha), debido a que los perfiles a 90 grados no son detectados por el modelo de visión YuNet.

## Assumptions
- YuNet está diseñado para detectar rostros frontales o semi-frontales (hasta 45°/60° de rotación) y por eso falla con fotos a 90° (perfil completo).
- Utilizar dos fotos frontales (ej. una limpia y una con lentes/gorra/diferente expresión) garantiza una detección del 100% de los frames y permite reconocer al alumno con y sin accesorios.
- Al ser una base de datos nueva, podemos eliminar las tablas existentes y volver a crearlas con el nuevo esquema simplificado.

## Plan
### Step 1: Actualizar el Script del Schema de Base de Datos
- **Files**:
  - [artifacts/superpowers/schema.sql](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/artifacts/superpowers/schema.sql) [MODIFY]
- **Change**:
  - Actualizar `schema.sql` para reemplazar las columnas `embedding_left` y `embedding_right` por la columna única `embedding_accessories vector(128)`.
- **Verify**: El usuario ejecutará el nuevo SQL en el editor de Supabase para actualizar la estructura.

### Step 2: Modificar los Métodos de la Base de Datos (CRUD)
- **Files**:
  - [src/db.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/db.py) [MODIFY]
- **Change**:
  - Modificar `register_student` para recibir `embedding_frontal` y `embedding_accessories`.
  - Actualizar el diccionario de inserción de Supabase.
- **Verify**: Ejecutar `.\.venv\Scripts\python.exe -c "import src.db"` para confirmar que no hay errores de sintaxis.

### Step 3: Modificar la Lógica de Comparación de Rostros
- **Files**:
  - [src/recognizer.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/recognizer.py) [MODIFY]
- **Change**:
  - Modificar la función `match_face` para que busque coincidencias comparando el rostro en vivo contra las columnas `embedding_frontal` y `embedding_accessories`.
- **Verify**: Ejecutar `.\.venv\Scripts\python.exe -m src.recognizer` y constatar la importación limpia.

### Step 4: Actualizar los Endpoints en la API de FastAPI
- **Files**:
  - [src/main.py](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/src/main.py) [MODIFY]
- **Change**:
  - Modificar el endpoint `/api/register` para que acepte únicamente los campos de formulario: `photo_frontal` y `photo_accessories` (ambos `UploadFile`).
  - Extraer embeddings para ambas imágenes nítidas y guardarlos en Supabase.
- **Verify**: Ejecutar `.\.venv\Scripts\python.exe -c "import src.main"` para validar sintaxis de la API.

### Step 5: Modificar la Interfaz Gráfica del Frontend (React)
- **Files**:
  - [frontend/src/App.jsx](file:///c:/Users/Radic/OneDrive/Escritorio/Proyecto%20SCANFACE/frontend/src/App.jsx) [MODIFY]
- **Change**:
  - Actualizar el formulario de registro de estudiantes para mostrar únicamente dos cargadores de archivos: "Foto Frontal (Sin Accesorios)" y "Foto Frontal (Con Accesorios)".
  - Eliminar los selectores, estados y referencias de los perfiles laterales.
  - Ajustar el envío de `FormData` para enviar los dos archivos correspondientes al backend.
- **Verify**: Ejecutar la compilación con `npm run build` dentro de `frontend/`.

## Risks & mitigations
- **Risk**: Que se queden registros anteriores con el esquema viejo y falle la inserción.
  - *Mitigation*: Se recomienda recrear las tablas ejecutando el script actualizado de `schema.sql` (que contiene `DROP TABLE` previo).

## Rollback plan
- Ejecutar `git checkout src/main.py src/db.py src/recognizer.py frontend/src/App.jsx` para revertir los archivos modificados a su estado estable anterior.
