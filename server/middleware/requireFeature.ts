import { Request, Response, NextFunction } from 'express';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { getVpsJwt } from '../services/vpsApi';
import { loadExtensionRegistry } from '../services/extensionsRegistry';
import { loadUserSettingsForEmail } from '../services/userSettings';

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
      const registry = loadExtensionRegistry();
      const effective = resolveEffectiveFeatureFlags(settings, registry);

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
