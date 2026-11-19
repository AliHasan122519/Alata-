REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_banned(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(UUID) TO authenticated;
