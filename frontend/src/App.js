import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import HomePage from './home/HomePage';
import AboutPage from './about/AboutPage';
import PricingPage from './pricing/PricingPage';
import ProductsPage from './products/ProductsPage';
import Signup from './signup/Signup';
import SupportPage from './support/SupportPage';
import OpenAccount from './OpenAccount';
import NotFound from './NotFound';

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/open-account" element={<OpenAccount />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}

export default App;