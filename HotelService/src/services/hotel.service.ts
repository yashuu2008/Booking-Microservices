import { createHotelDTO } from "../dto/hotel.dto";
import { HotelRepository } from "../repositories/hotel.repository";
import { NotFoundError } from "../utils/errors/app.error";

const hotelRepository = new HotelRepository();

export async function createHotelService(hotelData: createHotelDTO) {
    const hotel = await hotelRepository.create(hotelData);
    return hotel;
}

export async function getHotelByIdService(id: number) {
    const hotel = await hotelRepository.findById(id);
    if (!hotel) {
        throw new NotFoundError(`Hotel with id ${id} not found`);
    }
    return hotel;
}

export async function getAllHotelsService() {
    const hotels = await hotelRepository.findAll();
    return hotels;
}

export async function deleteHotelService(id: number) {
    const response = await hotelRepository.softDelete(id);
    return response;
}