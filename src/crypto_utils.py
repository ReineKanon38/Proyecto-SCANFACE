import os
from cryptography.fernet import Fernet

KEY_FILE = os.path.join("data", "secret.key")

def get_encryption_key() -> bytes:
    """Gets the encryption key, generating one if it doesn't exist."""
    if not os.path.exists("data"):
        os.makedirs("data")
        
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
    else:
        key = Fernet.generate_key()
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        return key

def encrypt_data(data: str) -> str:
    """Encrypts a string into a base64 encrypted string."""
    if not data:
        return ""
    key = get_encryption_key()
    fernet = Fernet(key)
    return fernet.encrypt(data.encode()).decode()

def decrypt_data(encrypted_data: str) -> str:
    """Decrypts a base64 encrypted string back into a plain string."""
    if not encrypted_data:
        return ""
    key = get_encryption_key()
    fernet = Fernet(key)
    try:
        return fernet.decrypt(encrypted_data.encode()).decode()
    except Exception:
        return "[Decryption Error]"

if __name__ == "__main__":
    # Test encryption/decryption
    test_str = "Juan Perez - Alumno 12345"
    enc = encrypt_data(test_str)
    dec = decrypt_data(enc)
    print("Test string:", test_str)
    print("Encrypted:", enc)
    print("Decrypted:", dec)
    assert test_str == dec, "Encryption/Decryption mismatch!"
    print("Crypto check passed!")
