FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir --default-timeout=300 --retries 10 pandas==2.2.3 numpy==2.2.4
COPY api ./api
COPY pipeline ./pipeline
COPY web ./web
ENV HOST=0.0.0.0
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request as u;u.urlopen('http://localhost:8000/data/meta.json')"
CMD ["python", "api/server.py", "8000"]
