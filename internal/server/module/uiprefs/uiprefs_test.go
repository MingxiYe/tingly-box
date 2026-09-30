package uiprefs

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/tingly-dev/tingly-box/internal/server/config"
)

func newRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	cfg, err := config.NewConfigWithDir(t.TempDir(), config.WithDisableMigration())
	require.NoError(t, err)
	h := NewHandler(cfg)
	r := gin.New()
	r.GET("/ui-prefs", h.Get)
	r.PATCH("/ui-prefs", h.Patch)
	return r
}

func do(t *testing.T, r *gin.Engine, method, body string) (int, UIPrefsResponse) {
	t.Helper()
	req := httptest.NewRequest(method, "/ui-prefs", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp UIPrefsResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return w.Code, resp
}

func TestUIPrefsRoundTrip(t *testing.T) {
	r := newRouter(t)

	code, resp := do(t, r, http.MethodPatch, `{"prefs":{"scenario.hidden":["pi"],"x":1}}`)
	require.Equal(t, http.StatusOK, code)
	assert.True(t, resp.Success)

	code, resp = do(t, r, http.MethodPatch, `{"prefs":{"x":null}}`)
	require.Equal(t, http.StatusOK, code)

	code, resp = do(t, r, http.MethodGet, ``)
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, `["pi"]`, string(resp.Prefs["scenario.hidden"]))
	assert.NotContains(t, resp.Prefs, "x")
}

func TestUIPrefsPatchRejectsMissingBody(t *testing.T) {
	r := newRouter(t)
	code, resp := do(t, r, http.MethodPatch, `{}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.False(t, resp.Success)
}
