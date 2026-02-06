# Sử dụng Node.js phiên bản mới
FROM node:20

# Tạo thư mục làm việc
WORKDIR /app

# Copy file package.json vào trước
COPY package.json ./

# Chạy lệnh cài đặt (Đây là bước quan trọng thay thế cho file lock)
RUN npm install

# Copy toàn bộ code còn lại vào
COPY . .

# Mở cổng 8080 (Để Koyeb biết app đang chạy)
EXPOSE 8080

# Chạy bot
CMD ["node", "index.js"]
