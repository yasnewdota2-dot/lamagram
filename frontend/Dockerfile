# ---------- Stage 1: build the React app with yarn ----------
FROM node:20-alpine AS build

WORKDIR /app

# The frontend reads REACT_APP_BACKEND_URL at build time (CRA bakes it in).
# It is injected via docker-compose's `args` so users can set it from .env.
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .
RUN yarn build

# ---------- Stage 2: serve the static bundle with nginx ----------
FROM nginx:alpine

# SPA-friendly nginx config that falls back to index.html.
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location ~* \\.(?:js|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|gif|webp|ico)$ {\n\
        expires 7d;\n\
        access_log off;\n\
        add_header Cache-Control "public, max-age=604800, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
