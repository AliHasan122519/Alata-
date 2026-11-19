import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import Store from "./Store";

const Index = () => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-hero" />;
  if (!user) return <Navigate to="/auth" replace />;
  return <Store />;
};

export default Index;
