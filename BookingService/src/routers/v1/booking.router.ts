import express from 'express';
import { validateRequestBody } from '../../validators';
import { createBookingSchema } from '../../validators/booking.validator';
import { confirmBookingHandler, createBookingHandler, getBookingByIdHandler } from '../../controllers/booking.controller';

const bookingRouter = express.Router();

bookingRouter.post('/', validateRequestBody(createBookingSchema), createBookingHandler);
bookingRouter.post('/confirm/:idempotencyKey', confirmBookingHandler);
bookingRouter.get('/:id', getBookingByIdHandler);

export default bookingRouter;
