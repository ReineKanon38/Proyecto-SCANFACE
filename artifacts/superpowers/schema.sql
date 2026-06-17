-- Habilitar la extensión vector para el soporte de embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Crear la tabla de alumnos
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    embedding_frontal vector(128),
    embedding_accessories vector(128)
);

-- Crear la tabla de logs de asistencia
CREATE TABLE IF NOT EXISTS attendance_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
