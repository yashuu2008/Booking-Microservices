import express from "express";
import request from "supertest";
import * as hotelService from "../../src/services/hotel.service";
import router from "../../src/routers/v1/index.router";

jest.mock("../../src/services/hotel.service");

describe("Hotel Controller", () => {
  const app = express().use(express.json()).use("/api/v1", router);

  it("POST /api/v1/hotels returns 201 with created hotel", async () => {
    (hotelService.createHotelService as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Hotel A",
    });

    const res = await request(app).post("/api/v1/hotels").send({
      name: "Hotel A",
      address: "123 Main St",
      location: "Delhi",
      rating: 4.5,
      ratingCount: 10,
    });

    expect(res.status).toBe(201);
    expect(res.body?.data).toMatchObject({ id: 1, name: "Hotel A" });
    expect(hotelService.createHotelService).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Hotel A" })
    );
  });

  it("handles service errors -> 400/500", async () => {
    (hotelService.createHotelService as jest.Mock).mockRejectedValue(
      new Error("Bad")
    );

    const res = await request(app).post("/api/v1/hotels").send({ name: "X" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe("GET /api/v1/hotels/:id", () => {
    it("should return 200 with hotel data", async () => {
      const mockHotel = { id: 1, name: "Hotel A", location: "New Delhi" };
      (hotelService.getHotelByIdService as jest.Mock).mockResolvedValue(
        mockHotel
      );

      const res = await request(app).get("/api/v1/hotels/1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: "Hotel found successfully",
        data: mockHotel,
        success: true,
      });
      expect(hotelService.getHotelByIdService).toHaveBeenCalledWith(1);
    });
  });

  describe("GET /api/v1/hotels", () => {
    it("should return 200 with all hotels", async () => {
      const mockHotels = [
        { id: 1, name: "Hotel A" },
        { id: 2, name: "Hotel B" },
      ];
      (hotelService.getAllHotelsService as jest.Mock).mockResolvedValue(
        mockHotels
      );

      const res = await request(app).get("/api/v1/hotels");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: "Hotels found successfully",
        data: mockHotels,
        success: true,
      });
      expect(hotelService.getAllHotelsService).toHaveBeenCalled();
    });

    it("should return empty array if no hotels exist", async () => {
      (hotelService.getAllHotelsService as jest.Mock).mockResolvedValue([]);

      const res = await request(app).get("/api/v1/hotels");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: "Hotels found successfully",
        data: [],
        success: true,
      });
    });
  });

  describe("DELETE /api/v1/hotels/:id", () => {
    it("should return 200 when hotel is deleted successfully", async () => {
      const mockDeletedHotel = { id: 1, name: "Deleted Hotel" };
      (hotelService.deleteHotelService as jest.Mock).mockResolvedValue(mockDeletedHotel);

      const res = await request(app).delete("/api/v1/hotels/1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: "Hotel deleted successfully",
        data: mockDeletedHotel,
        success: true,
      });
      expect(hotelService.deleteHotelService).toHaveBeenCalledWith(1);
    });
  });
});
