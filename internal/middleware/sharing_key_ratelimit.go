package middleware

import (
	"fmt"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/tingly-dev/tingly-box/internal/constant"
	"github.com/tingly-dev/tingly-box/internal/ratelimit"
)

// SharingKeyRateLimitMiddleware enforces a sharing key's requests-per-minute
// budget (TEP-1851). It must run after ModelAuthMiddleware, which puts the
// key id and its rpm_limit on the context for sharing-key callers.
//
// Scope, by design:
//   - Only requests authenticated with a sharing key are counted; the global
//     model token and enterprise callers pass through untouched.
//   - Only POST requests count. GET /models and GET /quota are discovery
//     calls a client may poll, and the budget is meant for model invocations.
//   - A key whose rpm_limit is 0 is unlimited and never reaches the limiter.
//
// On exceed the request is answered with 429, a Retry-After header (whole
// seconds, rounded up) and the standard error envelope, so SDK clients back
// off the way they do for upstream rate limits.
func SharingKeyRateLimitMiddleware(limiter ratelimit.Limiter) gin.HandlerFunc {
	if limiter == nil {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost ||
			c.GetString(constant.CtxKeyAuthKind) != constant.AuthKindSharingKey {
			c.Next()
			return
		}
		limit := c.GetInt(constant.CtxKeySharingKeyRPMLimit)
		keyID := c.GetString(constant.CtxKeySharingKeyID)
		if limit <= 0 || keyID == "" {
			c.Next()
			return
		}

		d := limiter.Allow(keyID, limit)
		if d.Allowed {
			c.Next()
			return
		}

		retryAfter := int(math.Ceil(d.RetryAfter.Seconds()))
		if retryAfter < 1 {
			retryAfter = 1
		}
		c.Header("Retry-After", fmt.Sprintf("%d", retryAfter))
		abortWithError(c, http.StatusTooManyRequests,
			fmt.Sprintf("Sharing key rate limit exceeded (%d requests/minute). Retry after %d second(s).", limit, retryAfter),
			"rate_limit_error")
	}
}
