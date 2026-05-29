import { Request, Response, NextFunction } from 'express';
import type { EffectiveFeatureFlags } from '../../shared/featureFlags';
import { getVpsJwt } from '../services/vpsApi';
import {
  loadUserSettingsForEmail,
  resolveEffectiveFeaturesForUser,
} from '../services/userFeatures';

export function requireFeature(feature: keyof EffectiveFeatureFlags) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.session.accessToken;
      const userEmail = req.session.userEmail;

      if (!token || !userEmail) {
        res.status(401).json({ error: 'Not authenticated. Please sign in.' });
        return;
      }

      const vpsJwt = await getVpsJwt(token, userEmail);
      const settings = await loadUserSettingsForEmail(vpsJwt, userEmail);
      const effective = resolveEffectiveFeaturesForUser(userEmail, settings);

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
