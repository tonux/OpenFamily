import { z } from 'zod';
const schema = z.object({ a: z.string() }).strict();
try {
    schema.parse({ a: 'ok', sneaky_extra: 'pwn' });
} catch (e) {
    console.log(JSON.stringify(e.issues, null, 2));
}
