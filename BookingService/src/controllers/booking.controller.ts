import { Request, Response } from 'express';
import { confirmBookingService, createBookingService, getBookingByIdService } from '../services/booking.service';

export const createBookingHandler = async (req: Request, res: Response) => {
    const booking = await createBookingService(req.body);

    res.status(201).json({
        success: true,
        message: "Booking created successfully",
        data: {
            bookingId: booking.bookingId,
            idempotencyKey: booking.idempotencyKey,
        }
    });
};

export const confirmBookingHandler = async (req: Request, res: Response) => {
    const booking = await confirmBookingService(req.params.idempotencyKey);

    res.status(200).json({
        success: true,
        message: "Booking confirmed successfully",
        data: {
            bookingId: booking.id,
            status: booking.status,
        }
    });
};

export const getBookingByIdHandler = async (req: Request, res: Response) => {
    const booking = await getBookingByIdService(Number(req.params.id));

    res.status(200).json({
        success: true,
        message: "Booking retrieved successfully",
        data: booking,
    });
};
