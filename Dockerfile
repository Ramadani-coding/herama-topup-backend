# Gunakan Node.js versi LTS
FROM node:18-alpine

# Set direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin file package.json dan package-lock.json
COPY package*.json ./

# Install dependensi (hanya production agar ringan)
RUN npm install --production

# Salin seluruh kode sumber proyek
COPY . .

# Expose port sesuai aplikasi Anda
EXPOSE 3000

# Jalankan aplikasi
CMD [ "node", "index.js" ]