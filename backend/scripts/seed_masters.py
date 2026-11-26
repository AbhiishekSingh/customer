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

# Item Master masters (client's AW 27-28 Commercial sheet — see
# claude/Item-Master-Phase1-Scope.md for the source files this was derived from). Every distinct
# real value seen across the sheet's four tabs (Men's/Women's Woven, Men's/Women's Knits) is
# included here, even near-duplicate spellings (e.g. 'Ero Mills' vs 'ERO Mills', 'Jubilee' vs
# 'Jubliee') — these were kept as separate entries rather than silently merged, since picking one
# canonical spelling per supplier is a judgment call for the client, not something to guess at.
GENDER_CATS = ["Men's", "Women's"]
SEASON_CATS = ['AW 27-28', 'SS 27-28']
STORY_CATS = ['Blue Savannah', 'Creative Chaos', 'Forest Whispers', 'Gilded Nights', 'Indi Luxe', 'Indi-Luxe', 'Rustic Terrains']
SUPPLIER_CATS = [
    'Ero Mills', 'ERO Mills', 'TRADC', 'TRADC/Color Cube', 'TRADC/Colour Cube', 'Bhaskar', 'Intellifab',
    'Ratanmoti Tex Fab', 'Ratanmoti', 'Shree Bharat', 'Keshrinandan', 'Suditi', 'Jayashree Mills', 'Ace Knits',
    'Avinya', 'Banarazi', 'Colour Cube', 'Epoque', 'Jubilee', 'Jubliee', 'Ramakrishna', 'Ramakrishna/Color Cube',
    'Ramakrishna/Colour Cube', 'VKS', 'Vivid', 'Fab G', 'FAB G', 'FabG', 'FAB-G/Colour Cube', 'Fab G/Color Cube',
    'Arthanari', 'BP Textile', 'Cotton Blossom', 'Elite', 'Exim', 'Imax', 'KTP', 'Kersainanthan', 'Korat Silk',
    'Lotus', 'Matrix', 'Omax', 'Sky textiles', 'Sky textiles.', 'Venkatesh', 'Venkatesh/Color Cube',
]
FABRIC_CATEGORY_CATS = ['Woven', 'Knit']
FABRIC_TYPE_CATS = [
    'Plain', 'Twill', 'Satin', 'Dobby', 'Jacquard', 'Shirting', 'Bottomweight', 'Yarn dyed', 'Pc dyed', 'Printed',
    'Embroidered', '2/1 T', '2/2 T', '2/2 Herringbone T', '3/1 RHT', 'Check', 'Stripe', 'Stripe Dobby', 'Plain/Seersucker',
]
PRINT_TYPE_CATS = ['Dyed', 'Printed', 'Digital Print', 'RFD', 'Rotary', 'RFD/Dyed', 'RFD/Dyed/Print', 'Natural Look, Acro Finish']

# Colors master ("type=color" — already consumed by the Fabrics/NewVisitEntry pages) has never had
# any values seeded; this script does NOT invent a starter list for it, since there's no "real"
# client-provided colour list yet (unlike the lists above, which all came straight from the sheet).
# Add colours via Masters > Categories once the client confirms what they want tracked.

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

TYPE_SEEDS = {
    'fabric': FABRIC_CATS,
    'customer': CUSTOMER_CATS,
    'gender': GENDER_CATS,
    'season': SEASON_CATS,
    'story': STORY_CATS,
    'supplier': SUPPLIER_CATS,
    'fabric_category': FABRIC_CATEGORY_CATS,
    'fabric_type': FABRIC_TYPE_CATS,
    'print_type': PRINT_TYPE_CATS,
}
for type_, names in TYPE_SEEDS.items():
    for name in names:
        if not db.query(Category).filter_by(type=type_, name=name).first():
            db.add(Category(type=type_, name=name))
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
