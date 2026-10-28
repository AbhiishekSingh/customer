# Import every model module so Base.metadata (and the declarative mapper registry, needed for
# string-based relationship() references across files) sees all tables before create_all()/Alembic
# autogenerate runs.
from app.models.blacklist import Approval, BlacklistEvent, Exception_  # noqa: F401
from app.models.category import Category, Country, State  # noqa: F401
from app.models.customer import Contact, Customer, Team  # noqa: F401
from app.models.fabric import Fabric  # noqa: F401
from app.models.mail import ItemFeedback, Mail, MailResponse, PastMailToken  # noqa: F401
from app.models.misc import AuditLog, Notification, Outbox, SystemSettings  # noqa: F401
from app.models.user import PasswordResetToken, User  # noqa: F401
from app.models.visit import Visit, VisitContact, VisitItem  # noqa: F401
