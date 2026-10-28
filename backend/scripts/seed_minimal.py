"""Minimal seed: one user per role, for manual/smoke testing of the auth flow.
Run: python3 -m scripts.seed_minimal
"""
from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
import app.models  # noqa
from app.models.enums import RoleEnum
from app.models.user import User

Base.metadata.create_all(bind=engine)

db = SessionLocal()
seed_users = [
    ("Priya Nair", "priya.nair@example.com", RoleEnum.design),
    ("Kavita Iyer", "kavita.iyer@example.com", RoleEnum.manager),
    ("Nikhil Desai", "nikhil.desai@example.com", RoleEnum.admin),
    ("Rakesh Menon", "rakesh.menon@example.com", RoleEnum.top),
    ("Sunita Rao", "sunita.rao@example.com", RoleEnum.top),
]
for name, email, role in seed_users:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        continue
    db.add(User(name=name, email=email, password_hash=hash_password("Passw0rd!123"), role=role))
db.commit()
print("Seeded users:", [u.email for u in db.query(User).all()])
db.close()
