import React from "react";

import Dashboard from "./Dashboard";
import TopBar from "./TopBar";
import ChatWidget from "./Copilot/ChatWidget";

const Home = () => {
  return (
    <>
      <TopBar />
      <Dashboard />
      <ChatWidget />
    </>
  );
};

export default Home;
