import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Clock, RefreshCw, History, Calculator } from "lucide-react";

interface Calculation {
  id: string;
  hourlyWage: number;
  productPrice: number;
  workHours: number;
  workDays: number;
  timestamp: Date;
}

const WorkTimeCalculator = () => {
  const [hourlyWage, setHourlyWage] = useState<string>("");
  const [productPrice, setProductPrice] = useState<string>("");
  const [showResult, setShowResult] = useState(false);
  const [showInDays, setShowInDays] = useState(false);
  const [calculations, setCalculations] = useState<Calculation[]>([]);

  // Load calculations from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("workTimeCalculations");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCalculations(parsed.map((calc: any) => ({
          ...calc,
          timestamp: new Date(calc.timestamp)
        })));
      } catch (error) {
        console.error("Failed to load calculations:", error);
      }
    }
  }, []);

  // Save calculations to localStorage
  const saveCalculation = (calculation: Calculation) => {
    const updated = [calculation, ...calculations.slice(0, 4)]; // Keep last 5
    setCalculations(updated);
    localStorage.setItem("workTimeCalculations", JSON.stringify(updated));
  };

  const calculateWorkTime = () => {
    const wage = parseFloat(hourlyWage);
    const price = parseFloat(productPrice);
    
    if (!wage || !price || wage <= 0 || price <= 0) return null;
    
    const workHours = price / wage;
    const workDays = workHours / 8;
    
    return { workHours, workDays };
  };

  const result = calculateWorkTime();

  const handleCalculate = () => {
    if (result) {
      setShowResult(true);
      
      const calculation: Calculation = {
        id: Date.now().toString(),
        hourlyWage: parseFloat(hourlyWage),
        productPrice: parseFloat(productPrice),
        workHours: result.workHours,
        workDays: result.workDays,
        timestamp: new Date()
      };
      
      saveCalculation(calculation);
    }
  };

  const handleNewCalculation = () => {
    setHourlyWage("");
    setProductPrice("");
    setShowResult(false);
  };

  const formatTime = (hours: number) => {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    
    if (wholeHours === 0) {
      return `${minutes} minutes`;
    } else if (minutes === 0) {
      return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''}`;
    } else {
      return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''} ${minutes} minutes`;
    }
  };

  const formatDays = (days: number) => {
    if (days < 1) {
      return formatTime(days * 8);
    }
    
    const wholeDays = Math.floor(days);
    const remainingHours = (days - wholeDays) * 8;
    
    if (remainingHours < 0.5) {
      return `${wholeDays} workday${wholeDays !== 1 ? 's' : ''}`;
    } else {
      return `${wholeDays} day${wholeDays !== 1 ? 's' : ''} ${formatTime(remainingHours)}`;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-main flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Calculator className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">Work Time Calculator</h1>
          </div>
          <p className="text-muted-foreground">
            Discover how much work time a purchase really costs
          </p>
        </div>

        {/* Main Calculator Card */}
        <Card className="bg-gradient-card shadow-card border-0 p-6 space-y-6">
          <div className="space-y-4">
            {/* Hourly Wage Input */}
            <div className="space-y-2">
              <Label htmlFor="hourlyWage" className="text-sm font-medium">
                Your hourly wage
              </Label>
              <div className="relative">
                <Input
                  id="hourlyWage"
                  type="number"
                  placeholder="15"
                  value={hourlyWage}
                  onChange={(e) => setHourlyWage(e.target.value)}
                  className="pl-3 pr-8 h-12 text-lg"
                  min="0"
                  step="0.01"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  €/h
                </span>
              </div>
            </div>

            {/* Product Price Input */}
            <div className="space-y-2">
              <Label htmlFor="productPrice" className="text-sm font-medium">
                Product price
              </Label>
              <div className="relative">
                <Input
                  id="productPrice"
                  type="number"
                  placeholder="299"
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                  className="pl-3 pr-8 h-12 text-lg"
                  min="0"
                  step="0.01"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  €
                </span>
              </div>
            </div>

            {/* Calculate Button */}
            <Button 
              onClick={handleCalculate}
              disabled={!result}
              className="w-full h-12 text-lg font-medium bg-primary hover:bg-primary-hover transition-smooth"
            >
              <Clock className="w-5 h-5 mr-2" />
              Calculate Work Time
            </Button>
          </div>

          {/* Result Display */}
          {showResult && result && (
            <div className="bg-gradient-result border border-accent/20 rounded-lg p-4 space-y-3 shadow-result animate-in slide-in-from-top-2 duration-500">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-accent-foreground mb-2">
                  You need to work:
                </h3>
                <div className="text-2xl font-bold text-accent-foreground">
                  {showInDays ? formatDays(result.workDays) : formatTime(result.workHours)}
                </div>
                <p className="text-sm text-accent-foreground/80 mt-1">
                  for this {productPrice}€ purchase
                </p>
              </div>
              
              {/* Toggle View */}
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInDays(!showInDays)}
                  className="text-xs bg-white/50 border-accent/30 hover:bg-white/70"
                >
                  Switch to {showInDays ? "hours" : "workdays"}
                </Button>
              </div>
            </div>
          )}

          {/* Compare Another Item */}
          {showResult && (
            <Button 
              onClick={handleNewCalculation}
              variant="outline"
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Compare Another Item
            </Button>
          )}
        </Card>

        {/* Recent Calculations */}
        {calculations.length > 0 && (
          <Card className="bg-gradient-card shadow-card border-0 p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-muted-foreground">Recent Calculations</h3>
            </div>
            <div className="space-y-2">
              {calculations.slice(0, 3).map((calc) => (
                <div key={calc.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {calc.productPrice}€ @ {calc.hourlyWage}€/h
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {formatTime(calc.workHours)}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default WorkTimeCalculator;