from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from config import AppConfig
from routes.chat_routes import chat_bp
from routes.setup_routes import setup_bp
from routes.work_item_routes import work_items_bp
from routes.test_plan_routes import test_plans_bp
from routes.test_assignment_workbook_routes import assignment_workbook_bp

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    app.register_blueprint(setup_bp)
    app.register_blueprint(work_items_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(test_plans_bp)
    app.register_blueprint(assignment_workbook_bp)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/<path:path>")
    def frontend(path: str):
        return send_from_directory(FRONTEND_DIR, path)

    @app.errorhandler(RuntimeError)
    def runtime_error(error: RuntimeError):
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(ValueError)
    def value_error(error: ValueError):
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(Exception)
    def unhandled_error(error: Exception):
        return jsonify({"error": str(error)}), 500

    return app


if __name__ == "__main__":
    config = AppConfig.from_env()
    app = create_app()
    app.run(
        host=config.flask_host,
        port=config.flask_port,
        debug=config.flask_debug,
    )
