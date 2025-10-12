#!/usr/bin/env python3
"""
Verify that the analytics-ui folder has all required dependencies for standalone deployment.
This script should run successfully when analytics-ui is the repository root.
"""
from pathlib import Path
import sys

def verify_deployment():
    print("🔍 Verifying Analytics UI Deployment Structure\n")

    # Get the analytics-ui root (parent of automation/)
    script_path = Path(__file__).resolve()
    automation_dir = script_path.parent
    analytics_ui_root = automation_dir.parent

    print(f"📁 Analytics UI Root: {analytics_ui_root}\n")

    required_folders = {
        'utils': 'Database, geocoding, embeddings utilities',
        'config': 'Settings and configuration',
        'automation': 'Pipeline scripts and workers',
        'sql': 'Database migrations and functions',
        'src': 'React frontend',
    }

    required_files = {
        'utils/database.py': 'Supabase client',
        'utils/geocoding.py': 'Geocoding utilities',
        'config/settings.py': 'Environment configuration',
        'automation/worker/pipeline_worker.py': 'Pipeline orchestrator',
        'automation/scripts/backfill_coordinates.py': 'Coordinate backfill script',
        'package.json': 'NPM dependencies',
        'vite.config.ts': 'Vite build configuration',
    }

    all_ok = True

    # Check folders
    print("📦 Required Folders:")
    for folder, description in required_folders.items():
        folder_path = analytics_ui_root / folder
        if folder_path.exists() and folder_path.is_dir():
            print(f"  ✅ {folder}/ - {description}")
        else:
            print(f"  ❌ {folder}/ - MISSING - {description}")
            all_ok = False

    print()

    # Check files
    print("📄 Required Files:")
    for file, description in required_files.items():
        file_path = analytics_ui_root / file
        if file_path.exists() and file_path.is_file():
            print(f"  ✅ {file} - {description}")
        else:
            print(f"  ❌ {file} - MISSING - {description}")
            all_ok = False

    print()

    # Test imports
    print("🐍 Testing Python Imports:")

    # Ensure analytics-ui root is in path
    analytics_ui_str = str(analytics_ui_root)
    if analytics_ui_str not in sys.path:
        sys.path.insert(0, analytics_ui_str)

    try:
        import utils.database
        print(f"  ✅ utils.database - found at {utils.database.__file__}")
    except ImportError as e:
        print(f"  ❌ utils.database - {e}")
        all_ok = False
    except Exception as e:
        # Env var errors are expected without .env file
        if "environment variable" in str(e).lower():
            print(f"  ✅ utils.database - found (env vars needed at runtime)")
        else:
            print(f"  ⚠️  utils.database - imported but error: {e}")

    try:
        import config.settings
        print(f"  ✅ config.settings - found at {config.settings.__file__}")
    except ImportError as e:
        print(f"  ❌ config.settings - {e}")
        all_ok = False
    except Exception as e:
        # Env var errors are expected without .env file
        if "environment variable" in str(e).lower():
            print(f"  ✅ config.settings - found (env vars needed at runtime)")
        else:
            print(f"  ⚠️  config.settings - imported but error: {e}")

    print()

    # Test pipeline worker detection
    print("🚀 Testing Pipeline Worker Detection:")
    try:
        from automation.worker.pipeline_worker import REPO_ROOT
        print(f"  ✅ REPO_ROOT detected as: {REPO_ROOT}")
        if str(REPO_ROOT) == str(analytics_ui_root):
            print(f"  ✅ Standalone deployment correctly detected")
        else:
            print(f"  ⚠️  REPO_ROOT mismatch - expected {analytics_ui_root}")
    except Exception as e:
        # Env var errors are expected without .env file
        if "environment variable" in str(e).lower():
            print(f"  ✅ Worker imports correctly (env vars needed at runtime)")
        else:
            print(f"  ❌ Failed to test detection: {e}")
            all_ok = False

    print()

    if all_ok:
        print("✅ Deployment structure is valid!")
        print("   Ready for standalone deployment to Vercel")
    else:
        print("❌ Deployment structure has issues")
        print("   Fix the missing files/folders before deploying")

    return all_ok

if __name__ == '__main__':
    success = verify_deployment()
    sys.exit(0 if success else 1)
