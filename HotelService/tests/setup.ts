// Jest global setup for HotelService tests
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

process.env.TZ = 'UTC';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
