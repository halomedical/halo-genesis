import { Request, Response, NextFunction } from 'express';
import type { AppPersona } from '../../shared/appPersona';
import { isValidAppPersona } from '../../shared/appPersona';

export function requirePersona(...allowed: AppPersona[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session.accessToken) {
      res.status(401).json({ error: 'Not authenticated. Please sign in.' });
      return;
    }

    const persona = req.session.appPersona;
    if (!persona || !isValidAppPersona(persona)) {
      res.status(428).json({ error: 'Choose Dr Haasbroek or Admin Staff to continue.' });
      return;
    }

    if (!allowed.includes(persona)) {
      res.status(403).json({ error: 'This action is not available for your workspace.' });
      return;
    }

    next();
  };
}

/** Any signed-in user who has completed the persona chooser. */
export function requireAnyPersona(req: Request, res: Response, next: NextFunction): void {
  requirePersona('clinician', 'admin_staff')(req, res, next);
}

/** Template studio / upload / shared-forms management. */
export function requireAdminStaffPersona(req: Request, res: Response, next: NextFunction): void {
  requirePersona('admin_staff')(req, res, next);
}
