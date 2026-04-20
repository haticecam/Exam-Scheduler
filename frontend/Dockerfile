FROM node:20-alpine

WORKDIR /app

# Paket dosyalarını kopyala
COPY package*.json ./

# Bağımlılıkları yükle
RUN npm install

# Geri kalan kodları kopyala
COPY . .

# Port
EXPOSE 3000

# Geliştirme modunda başlat (Canlı yenileme aktif)
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
