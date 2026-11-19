import axios from "axios";
import { serverConfig } from "../config";

const getBaseHotelUrl = () => {
    return serverConfig.HOTEL_SERVICE_URL.replace(/\/+$/, '');
};

export const getAvailableRooms = async (roomCategoryId: number, checkInDate: string, checkOutDate: string) => {
    const response = await axios.get(`${getBaseHotelUrl()}/rooms/available`, {
        params: {
            roomCategoryId,
            checkInDate,
            checkOutDate
        },
    });

    return response.data;
};

export const updateBookingIdToRooms = async (bookingId: number, roomIds: number[]) => {
    const response = await axios.post(`${getBaseHotelUrl()}/rooms/update-booking-id`, {
        bookingId,
        roomIds
    });

    return response.data;
};
