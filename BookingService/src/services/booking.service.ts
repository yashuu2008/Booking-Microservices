import { CreateBookingDTO } from '../dto/booking.dto';
import {
    confirmBooking,
    createBooking,
    createIdempotencyKey,
    finalizeIdempotencyKey,
    getBookingById,
    getIdempotencyKeyWithLock
} from '../repositories/booking.repository';
import { BadRequestError, InternalServerError, NotFoundError } from '../utils/errors/app.error';
import { generateIdempotencyKey } from '../utils/generateIdempotencyKey';
import prismaClient from '../prisma/client';
import { redlock } from '../config/redis.config';
import { serverConfig } from '../config';
import { getAvailableRooms, updateBookingIdToRooms } from '../api/hotel.api';
import { addEmailToQueue } from '../producers/email.producer';

type AvailableRoom = {
    id: number;
    roomCategoryId: number;
    dateOfAvailability: Date;
};

export async function createBookingService(createBookingDTO: CreateBookingDTO) {
    const ttl = serverConfig.LOCK_TTL;
    const bookingResource = `hotel:${createBookingDTO.hotelId}:category:${createBookingDTO.roomCategoryId}`;

    const checkinDate = new Date(createBookingDTO.checkInDate);
    const checkoutDate = new Date(createBookingDTO.checkOutDate);

    if (checkinDate >= checkoutDate) {
        throw new BadRequestError("Check-in date must be before check-out date");
    }

    const totalNights = Math.ceil(
        (checkoutDate.getTime() - checkinDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 1. Query HotelService for availability
    const availableRoomsResponse = await getAvailableRooms(
        createBookingDTO.roomCategoryId,
        createBookingDTO.checkInDate,
        createBookingDTO.checkOutDate
    );

    const availableRooms: AvailableRoom[] = availableRoomsResponse.data || [];

    if (!availableRooms || availableRooms.length < totalNights) {
        throw new BadRequestError("No available rooms for the selected dates");
    }

    // 2. Acquire Distributed Lock and Reserve
    let lock;
    try {
        lock = await redlock.acquire([bookingResource], ttl);

        const booking = await createBooking({
            userId: createBookingDTO.userId,
            hotelId: createBookingDTO.hotelId,
            roomCategoryId: createBookingDTO.roomCategoryId,
            totalGuests: createBookingDTO.totalGuests,
            bookingAmount: createBookingDTO.bookingAmount,
            checkInDate: checkinDate,
            checkOutDate: checkoutDate,
        });

        const idempotencyKey = generateIdempotencyKey();
        await createIdempotencyKey(idempotencyKey, booking.id);

        // 3. Mark the rooms reserved in HotelService
        const roomIds = availableRooms.map((room) => room.id);
        await updateBookingIdToRooms(booking.id, roomIds);

        return {
            bookingId: booking.id,
            idempotencyKey: idempotencyKey,
        };
    } catch (error: any) {
        if (error instanceof BadRequestError || error instanceof NotFoundError) {
            throw error;
        }
        throw new InternalServerError('Failed to process booking or acquire distributed lock');
    } finally {
        if (lock) {
            await lock.release().catch((err: any) => {
                console.error('Error releasing distributed lock:', err);
            });
        }
    }
}

export async function confirmBookingService(idempotencyKey: string) {
    const booking = await prismaClient.$transaction(async (tx) => {
        const idempotencyKeyData = await getIdempotencyKeyWithLock(tx, idempotencyKey);

        if (!idempotencyKeyData || !idempotencyKeyData.bookingId) {
            throw new NotFoundError('Idempotency key not found');
        }

        if (idempotencyKeyData.finalized) {
            throw new BadRequestError('Idempotency key already finalized');
        }

        const confirmedBooking = await confirmBooking(tx, idempotencyKeyData.bookingId);
        await finalizeIdempotencyKey(tx, idempotencyKey);

        return confirmedBooking;
    });

    // Asynchronously dispatch confirmation notification to email queue
    addEmailToQueue({
        to: `user-${booking.userId}@example.com`,
        subject: `Airbnb Booking Confirmation - #${booking.id}`,
        templateId: "booking_confirmation",
        params: {
            bookingId: booking.id,
            hotelId: booking.hotelId,
            roomCategoryId: booking.roomCategoryId,
            totalGuests: booking.totalGuests,
            bookingAmount: booking.bookingAmount,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            status: booking.status,
        }
    }).catch((err) => {
        console.error("Failed to enqueue booking confirmation email:", err);
    });

    return booking;
}

export async function getBookingByIdService(bookingId: number) {
    const booking = await getBookingById(bookingId);
    if (!booking) {
        throw new NotFoundError('Booking not found');
    }
    return booking;
}
