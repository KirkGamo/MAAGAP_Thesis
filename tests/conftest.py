"""
Phase 14: shared pytest configuration for the MAAGAP test suite.

ml-service's modules (data_pipeline, optimization_engine, main) are not an
installed package -- they're imported the same way optimization_engine.py
itself does it (see that file's own sys.path.insert lines), by adding
ml-service/ to sys.path. This conftest.py does that once, at collection
time, so every test module under tests/ can `import optimization_engine`,
`from data_pipeline.feature_engineering import ...`, or `from main import app`
without duplicating path setup in each file.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_SERVICE_DIR = REPO_ROOT / "ml-service"

for p in (ML_SERVICE_DIR, ML_SERVICE_DIR / "models"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
