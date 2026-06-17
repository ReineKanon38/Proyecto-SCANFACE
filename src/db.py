import os
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client

# Load environment variables manually
if os.path.exists(".env"):
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in environment.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_all_students():
    """Fetches all students from Supabase."""
    try:
        response = supabase.table("students").select("*").execute()
        return response.data
    except Exception as e:
        print(f"Error fetching students: {e}")
        return []

def register_student(student_id: str, encrypted_name: str, embedding_frontal: list[float], embedding_left: list[float], embedding_right: list[float]):
    """Registers a new student in Supabase."""
    data = {
        "id": student_id,
        "name": encrypted_name,
        "embedding_frontal": embedding_frontal,
        "embedding_left": embedding_left,
        "embedding_right": embedding_right
    }
    try:
        response = supabase.table("students").insert(data).execute()
        return response.data
    except Exception as e:
        print(f"Error registering student: {e}")
        raise e

def check_attendance_cooldown(student_id: str, cooldown_minutes: int = 5) -> bool:
    """Returns True if the student is on cooldown (recently registered attendance)."""
    try:
        # Get the latest attendance log for the student
        response = supabase.table("attendance_logs")\
            .select("timestamp")\
            .eq("student_id", student_id)\
            .order("timestamp", desc=True)\
            .limit(1)\
            .execute()
        
        if not response.data:
            return False
        
        last_log_str = response.data[0]["timestamp"]
        # Supabase returns ISO timestamp with timezone, e.g., '2026-06-11T03:15:27+00:00'
        # Parse it
        # Replace Z with +00:00 for fromisoformat compatibility in python versions
        if last_log_str.endswith("Z"):
            last_log_str = last_log_str[:-1] + "+00:00"
            
        last_log_time = datetime.fromisoformat(last_log_str)
        now = datetime.now(timezone.utc)
        
        elapsed = now - last_log_time
        return elapsed < timedelta(minutes=cooldown_minutes)
    except Exception as e:
        print(f"Error checking attendance cooldown: {e}")
        return False

def log_attendance(student_id: str):
    """Records attendance for a student if not on cooldown."""
    if check_attendance_cooldown(student_id):
        print(f"Student {student_id} is on cooldown. Skipping log.")
        return None
    
    data = {
        "student_id": student_id
    }
    try:
        response = supabase.table("attendance_logs").insert(data).execute()
        return response.data
    except Exception as e:
        print(f"Error logging attendance: {e}")
        raise e

def update_frontal_embedding(student_id: str, new_embedding: list[float]):
    """Updates the frontal embedding in Supabase for adaptive learning."""
    try:
        response = supabase.table("students")\
            .update({"embedding_frontal": new_embedding})\
            .eq("id", student_id)\
            .execute()
        return response.data
    except Exception as e:
        print(f"Error updating frontal embedding: {e}")
        return None

def get_attendance_report():
    """Fetches all attendance logs joined with student details."""
    try:
        # We perform a select join in Supabase
        response = supabase.table("attendance_logs")\
            .select("id, timestamp, student_id, students(name)")\
            .order("timestamp", desc=True)\
            .execute()
        return response.data
    except Exception as e:
        print(f"Error fetching attendance report: {e}")
        return []

if __name__ == "__main__":
    print("Testing Supabase db module connection...")
    students = get_all_students()
    print(f"Successfully connected! Found {len(students)} students.")
