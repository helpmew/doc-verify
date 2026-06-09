import { useState } from 'react'
import {
  getPersonalizedUrlParams,
  type PersonalizedUrlParams,
} from '../lib/urlParams'

/**
 * Captures ref, session, and email from the URL once on mount.
 * Reusable on any page that needs personalized link context.
 */
export function usePersonalizedUrlParams(): PersonalizedUrlParams {
  const [params] = useState(getPersonalizedUrlParams)
  return params
}
