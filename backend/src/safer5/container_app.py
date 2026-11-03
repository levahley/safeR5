"""Container entrypoint; host port is loopback-bound by Compose."""

from .api import create_app

app = create_app()
