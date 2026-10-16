FROM node:20-alpine

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose port
ENV PORT=3030
EXPOSE 3030

# Start server
CMD ["node", "server/index.js"]
