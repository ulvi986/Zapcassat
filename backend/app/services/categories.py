"""Reference product categories (taxonomy, not business data) and auto-categorisation."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ProductCategory
from app.services.lexicon import analyze

# slug, az, en, tr, lucide icon, concept ids that map to this category
CATEGORY_SEED: list[tuple[str, str, str, str, str, set[str]]] = [
    ("qapi-pencere", "Qapı və pəncərələr", "Doors & windows", "Kapı ve pencereler", "door-open", {"door", "window", "handle", "hinge", "lock"}),
    ("taxta-lovhe", "Taxta və lövhə materialları", "Wood & boards", "Ahşap ve levhalar", "trees", {"wood", "board", "mdf", "chipboard", "plywood", "oak", "pine"}),
    ("dosheme", "Döşəmə örtükləri", "Flooring", "Zemin kaplamaları", "layers", {"laminate", "parquet", "baseboard", "panel"}),
    ("kafel-keramika", "Kafel və keramika", "Tiles & ceramics", "Fayans ve seramik", "grid-3x3", {"tile", "ceramic"}),
    ("tikinti-qarisiqlari", "Tikinti qarışıqları", "Building mixes", "Yapı karışımları", "package", {"cement", "concrete", "gypsum", "sand", "glue"}),
    ("divar-tavan", "Divar və tavan sistemləri", "Walls & ceilings", "Duvar ve tavan", "panels-top-left", {"drywall", "profile", "insulation", "brick"}),
    ("boya", "Boya və laklar", "Paints & coatings", "Boya ve vernik", "paint-bucket", {"paint"}),
    ("metal", "Metal məmulatları", "Metal products", "Metal ürünler", "hammer", {"metal", "steel", "aluminium", "rebar", "nail", "screw"}),
    ("santexnika", "Santexnika", "Plumbing", "Tesisat", "droplets", {"pipe", "faucet", "sink"}),
    ("elektrik", "Elektrik", "Electrical", "Elektrik", "zap", {"cable", "lamp"}),
    ("aletler", "Alətlər", "Tools", "Aletler", "wrench", {"tool"}),
    ("diger", "Digər", "Other", "Diğer", "boxes", set()),
]


def seed_categories(db: Session) -> None:
    existing = set(db.scalars(select(ProductCategory.slug)).all())
    for pos, (slug, az, en, tr, icon, concepts) in enumerate(CATEGORY_SEED):
        if slug not in existing:
            db.add(ProductCategory(slug=slug, name_az=az, name_en=en, name_tr=tr, icon=icon,
                                   keywords=" ".join(sorted(concepts)), position=pos))
    db.commit()


def list_categories(db: Session) -> list[ProductCategory]:
    return list(db.scalars(select(ProductCategory).order_by(ProductCategory.position)).all())


def guess_category_id(db: Session, text: str) -> uuid.UUID | None:
    """Pick the category whose concepts overlap most with the text. Product-type concepts beat materials."""
    concepts, _ = analyze(text)
    if not concepts:
        return None
    best: tuple[int, ProductCategory | None] = (0, None)
    for cat in list_categories(db):
        kw = set(cat.keywords.split())
        score = 0
        for c in concepts & kw:
            # product nouns weigh more than materials/colours
            score += 1 if c in {"wood", "mdf", "chipboard", "metal", "steel", "aluminium", "oak", "pine", "ceramic"} else 3
        if score > best[0]:
            best = (score, cat)
    return best[1].id if best[1] else None


def serialize_category(c: ProductCategory) -> dict:
    return {"id": str(c.id), "slug": c.slug, "name_az": c.name_az, "name_en": c.name_en, "name_tr": c.name_tr, "icon": c.icon}
