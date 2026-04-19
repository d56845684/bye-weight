FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download || true
COPY . .
RUN go mod tidy && go build -o auth_service .

FROM alpine:3.19
RUN apk add --no-cache tzdata ca-certificates
WORKDIR /app
COPY --from=builder /app/auth_service .
COPY --from=builder /app/migrations ./migrations
EXPOSE 8001
CMD ["./auth_service"]
