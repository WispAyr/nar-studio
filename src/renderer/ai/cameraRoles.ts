/**
 * Camera roles — what each of the four cameras is *for*. The AI Director uses
 * the role to pick the right camera (a presenter close-up is worth more than a
 * wide establishing shot) and to compose the right shot size for each angle.
 */

export type CameraRole = 'presenter' | 'guest' | 'wide' | 'aux'

export interface RoleMeta {
  id: CameraRole
  label: string
  /** Short chip label. */
  short: string
  /** Selection weight — higher = the director favours this camera. */
  weight: number
  /** Resting target face height in frame (0..1) the auto-framer composes to. */
  shotSize: number
  description: string
}

export const CAMERA_ROLES: RoleMeta[] = [
  {
    id: 'presenter', label: 'Presenter', short: 'PRES',
    weight: 1.0, shotSize: 0.26,
    description: "Main host — the director's home shot.",
  },
  {
    id: 'guest', label: 'Guest', short: 'GUEST',
    weight: 0.82, shotSize: 0.26,
    description: 'Interviewee — followed on their speaking turns.',
  },
  {
    id: 'wide', label: 'Wide', short: 'WIDE',
    weight: 0.34, shotSize: 0.13,
    description: 'Establishing two-shot — kept wide, used for variety.',
  },
  {
    id: 'aux', label: 'Aux', short: 'AUX',
    weight: 0.6, shotSize: 0.24,
    description: 'Secondary angle — cutaways and reaction shots.',
  },
]

/** Default mapping: CAM 1 presenter, CAM 2 guest, CAM 3 wide, CAM 4 aux. */
export const DEFAULT_ROLES: CameraRole[] = ['presenter', 'guest', 'wide', 'aux']

export function roleMeta(role: CameraRole): RoleMeta {
  return CAMERA_ROLES.find(m => m.id === role) ?? CAMERA_ROLES[0]
}

export function loadCameraRoles(): CameraRole[] {
  try {
    const raw = localStorage.getItem('nar-cam-roles')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return [0, 1, 2, 3].map(i =>
          CAMERA_ROLES.some(m => m.id === arr[i]) ? (arr[i] as CameraRole) : DEFAULT_ROLES[i],
        )
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_ROLES.slice()
}

export function saveCameraRoles(roles: CameraRole[]): void {
  try { localStorage.setItem('nar-cam-roles', JSON.stringify(roles)) } catch { /* ignore */ }
}
