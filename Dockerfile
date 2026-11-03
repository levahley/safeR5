FROM node:24-bookworm-slim AS ui
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY backend/src/ ./backend/src/
COPY --from=ui /build/dist ./frontend/dist
ENV PYTHONPATH=/app/backend/src SAFER5_DATA_DIR=/app/data SAFER5_FRONTEND_DIR=/app/frontend/dist
RUN useradd --create-home --uid 10001 safer5 && mkdir /app/data && chown safer5 /app/data
USER safer5
EXPOSE 8765
CMD ["python", "-m", "uvicorn", "safer5.container_app:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]
