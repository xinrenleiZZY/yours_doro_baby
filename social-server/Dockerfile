FROM node:22-alpine
WORKDIR /app
COPY server.js .
RUN mkdir -p /data
ENV PORT=9500
ENV DATA_FILE=/data/social.json
EXPOSE 9500
CMD ["node", "server.js"]
