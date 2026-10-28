"""Seed fabric/customer categories and the Country -> State master list, matching the
prototype's STATE_SEED exactly (India full 33 states/UTs; every other country a short list).
Run: python3 -m scripts.seed_masters
"""
from app.core.database import Base, SessionLocal, engine
import app.models  # noqa
from app.models.category import Category, Country, State

Base.metadata.create_all(bind=engine)
db = SessionLocal()

FABRIC_CATS = ['Linen', 'Cotton', 'Viscose', 'Modal', 'Lyocell', 'Wool', 'Knit', 'Satin', 'Blend']
CUSTOMER_CATS = ['Brand', 'Retailer', 'Exporter', 'Uniform supplier']

STATE_SEED = {
    'India': ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
              'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
              'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
              'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Chandigarh',
              'Puducherry', 'Jammu and Kashmir', 'Ladakh'],
    'United Arab Emirates': ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'],
    'United States': ['California', 'New York', 'Texas', 'Florida', 'Illinois', 'New Jersey', 'Georgia',
                       'North Carolina', 'Massachusetts', 'Pennsylvania'],
    'United Kingdom': ['England', 'Scotland', 'Wales', 'Northern Ireland'],
    'Bangladesh': ['Dhaka', 'Chattogram', 'Khulna', 'Rajshahi', 'Sylhet', 'Barishal', 'Rangpur', 'Mymensingh'],
    'Sri Lanka': ['Western', 'Central', 'Southern', 'Northern', 'Eastern', 'North Western', 'North Central', 'Uva', 'Sabaragamuwa'],
    'Nepal': ['Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'],
    'Singapore': [],
    'Other': [],
}

for name in FABRIC_CATS:
    if not db.query(Category).filter_by(type='fabric', name=name).first():
        db.add(Category(type='fabric', name=name))
for name in CUSTOMER_CATS:
    if not db.query(Category).filter_by(type='customer', name=name).first():
        db.add(Category(type='customer', name=name))
db.flush()

for country_name, states in STATE_SEED.items():
    country = db.query(Country).filter_by(name=country_name).first()
    if not country:
        country = Country(name=country_name)
        db.add(country)
        db.flush()
    for s in states:
        if not db.query(State).filter_by(country_id=country.id, name=s).first():
            db.add(State(country_id=country.id, name=s))

db.commit()
print("Seeded categories, countries, states.")
db.close()
