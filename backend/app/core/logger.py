import logging
import os
from datetime import datetime

# Setup Logging Configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("equivault_audit.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("EquiVaultAI")

def log_audit(user_id, action, status, details):
    """Creates a structured audit trail for compliance."""
    timestamp = datetime.utcnow().isoformat()
    log_entry = f"AUDIT | {timestamp} | User: {user_id} | Action: {action} | Status: {status} | Details: {details}"
    logger.info(log_entry)
