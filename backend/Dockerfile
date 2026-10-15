FROM node:22-alpine
WORKDIR /app
ENV DATABASE_URL=postgresql://finance:finance@db:5432/finance \
    PORT=3333 \
    WEB_ORIGIN=http://localhost:5173 \
    NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npx prisma migrate deploy
EXPOSE 3333
CMD ["npm", "run", "dev"]
