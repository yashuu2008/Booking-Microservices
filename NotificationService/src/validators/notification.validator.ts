import { z } from 'zod';

export const sendNotificationSchema = z.object({
    to: z.string({ message: "Recipient email is required" }).email({ message: "Recipient must be a valid email" }),
    subject: z.string({ message: "Subject is required" }).min(1, { message: "Subject cannot be empty" }),
    templateId: z.string({ message: "Template ID is required" }).min(1, { message: "Template ID cannot be empty" }),
    params: z.record(z.any()).optional().default({}),
});
