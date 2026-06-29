import { Request, Response, NextFunction } from 'express';
import type { EffectiveFeatureFlags } from '../../shared/featureFlags';
import { getPracticeEntitlementsForEmail } from '../services/practiceEntitlements';

export function requireFeature(feature: keyof EffectiveFeatureFlags) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userEmail = req.session.userEmail;

      if (!req.session.accessToken || !userEmail) {
        res.status(401).json({ error: 'Not authenticated. Please sign in.' });
        return;
      }

      const { effective } = await getPracticeEntitlementsForEmail(userEmail);

      if (!effective[feature]) {
        res.status(403).json({ error: `Feature disabled: ${feature}` });
        return;
      }

      next();
    } catch (err) {
      console.error(`Feature gate error (${feature}):`, err);
      res.status(500).json({ error: 'Failed to evaluate feature access.' });
    }
  };
}
