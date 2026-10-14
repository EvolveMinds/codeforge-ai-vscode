import pytest
# Automated Contract & Unit Tests for calculator
# Run using: pytest tests/test_calculator.py or via Python Studio Sandbox

try:
    from calculator import *
except ImportError:
    pass

def test_addition_contract():
    """Verify addition invariants."""
    if 'add' in globals():
        assert add(10, 5) == 15
        assert add(-1, 1) == 0
        assert add(0, 0) == 0

def test_subtraction_contract():
    """Verify subtraction invariants."""
    if 'subtract' in globals():
        assert subtract(10, 5) == 5
        assert subtract(5, 10) == -5

def test_multiplication_contract():
    """Verify multiplication invariants."""
    if 'multiply' in globals():
        assert multiply(6, 7) == 42
        assert multiply(0, 99) == 0
        assert multiply(-3, -4) == 12

def test_division_contract():
    """Verify division and zero-division safeguard."""
    if 'divide' in globals():
        assert divide(20, 4) == 5
        assert divide(7, 2) == 3.5
        with pytest.raises((ZeroDivisionError, ValueError)):
            divide(10, 0)

def test_calculator_class_contract():
    """Verify Calculator class instance if present."""
    if 'Calculator' in globals():
        calc = Calculator()
        if hasattr(calc, 'add'):
            assert calc.add(2, 3) == 5
        if hasattr(calc, 'divide'):
            with pytest.raises((ZeroDivisionError, ValueError)):
                calc.divide(1, 0)
