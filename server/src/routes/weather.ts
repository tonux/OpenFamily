import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { query } from '../db';
import { getWeeklyForecast } from '../weather/WeatherService';
import { WeatherError } from '../weather/errors';
import { weeklyForecastBodySchema } from '../schemas/weather';
import logger from '../lib/logger';

// =============================================================================
// /api/weather routes
//
// Today this surface is just the multi-day forecast used by the dashboard
// "weather details" modal. Auth-gated and namespaced separately from /api/ai
// because no AI tokens are spent here — it's a pure weather lookup.
// =============================================================================

const router = Router();
router.use(authMiddleware);

/**
 * POST /api/weather/forecast
 * Body: { latitude?, longitude?, days? }
 *
 * Resolves coordinates from the override body or the user's saved city, then
 * returns up to `days` days of daily forecast (default 7). 400 if no
 * location is available.
 */
router.post(
    '/forecast',
    validate({ body: weeklyForecastBodySchema }),
    async (req: AuthRequest, res) => {
        try {
            let latitude: number | null =
                typeof req.body.latitude === 'number' ? req.body.latitude : null;
            let longitude: number | null =
                typeof req.body.longitude === 'number' ? req.body.longitude : null;
            let cityLabel: string | null = null;

            if (latitude === null || longitude === null) {
                const userRow = await query(
                    'SELECT city, latitude, longitude FROM users WHERE id = $1',
                    [req.userId],
                );
                const u = userRow.rows[0] as
                    | {
                          city: string | null;
                          latitude: string | number | null;
                          longitude: string | number | null;
                      }
                    | undefined;
                if (u && u.latitude !== null && u.longitude !== null) {
                    latitude = Number(u.latitude);
                    longitude = Number(u.longitude);
                    cityLabel = u.city ?? null;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'NO_LOCATION', message: 'No saved location' },
                    });
                }
            }

            const days = typeof req.body.days === 'number' ? req.body.days : 7;
            const forecast = await getWeeklyForecast(latitude!, longitude!, days);

            res.json({ success: true, data: { ...forecast, city: cityLabel } });
        } catch (error) {
            if (error instanceof WeatherError) {
                logger.warn('weather.forecast_failed', {
                    code: error.code,
                    message: error.message,
                });
                return res.status(error.status).json({ success: false, error: error.toJSON() });
            }
            logger.error('weather.forecast_unexpected', {
                error: error instanceof Error ? error.message : String(error),
            });
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    },
);

export default router;
