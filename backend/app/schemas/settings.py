from pydantic import BaseModel, field_validator

from app.utils import is_valid_email_list


class HolidayIn(BaseModel):
    date: str
    name: str


class SettingsUpdate(BaseModel):
    intervals: list[int] | None = None
    weekend_days: list[int] | None = None
    holidays: list[HolidayIn] | None = None
    link_validity_days: int | None = None
    auto_send: bool | None = None
    b_grace_days: int | None = None
    senior_mgmt_email: str | None = None
    marketing_head_email: str | None = None
    marketing_cc: str | None = None
    report_frequency: str | None = None
    report_recipients: str | None = None

    @field_validator("intervals")
    @classmethod
    def positive_intervals(cls, v):
        if v is not None and any(x <= 0 for x in v):
            raise ValueError("Mail interval days must all be positive")
        return v

    @field_validator("weekend_days")
    @classmethod
    def valid_weekend_days(cls, v):
        if v is not None:
            if any(d < 0 or d > 6 for d in v):
                raise ValueError("weekend_days must be 0-6")
            if len(set(v)) != len(v):
                raise ValueError("weekend_days must not contain duplicates")
        return v

    @field_validator("link_validity_days", "b_grace_days")
    @classmethod
    def positive_bounded(cls, v):
        if v is not None and not (0 < v <= 365):
            raise ValueError("Must be a positive number of days, at most 365")
        return v

    @field_validator("senior_mgmt_email", "marketing_head_email", "marketing_cc", "report_recipients")
    @classmethod
    def valid_email_list(cls, v):
        if v is not None and not is_valid_email_list(v):
            raise ValueError("Contains an invalid email address")
        return v

    @field_validator("holidays")
    @classmethod
    def no_duplicate_dates(cls, v: list[HolidayIn] | None):
        if v is not None:
            dates = [h.date for h in v]
            if len(set(dates)) != len(dates):
                raise ValueError("Duplicate holiday dates are not allowed")
        return v
