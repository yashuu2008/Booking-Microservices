CREATE DATABASE IF NOT EXISTS auth_dev;
CREATE DATABASE IF NOT EXISTS airbnb_hotel;
CREATE DATABASE IF NOT EXISTS airbnb_booking;

GRANT ALL PRIVILEGES ON auth_dev.* TO 'appuser'@'%';
GRANT ALL PRIVILEGES ON airbnb_hotel.* TO 'appuser'@'%';
GRANT ALL PRIVILEGES ON airbnb_booking.* TO 'appuser'@'%';
FLUSH PRIVILEGES;
